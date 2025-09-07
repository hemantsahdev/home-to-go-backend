const express = require("express");
const router = express.Router();

const USERS=require("./Model/user");
const PLACES=require("./Model/place");
const BOOKING=require("./Model/booking");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken")

const dotenv = require("dotenv");
dotenv.config();


// IMAGES HANDLING
const imageDownloader=require("image-downloader");
const multer=require('multer');
const fs = require('fs');
const path = require('path');

// SUPABASE SETUP
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// Static file serving removed - now handled by Supabase
// router.use('/uploads',express.static(__dirname+"/uploads"))

// Helper function to get public URL from Supabase
const getSupabaseImageUrl = (fileName) => {
  const { data } = supabase.storage.from('hotel-images').getPublicUrl(fileName);
  return data.publicUrl;
};

const {validateUser} =require ("./validate");
const TEMP = require("./Model/tempBooking");




router.post("/register", async (req,res)=>{

    const {name,email,password}=req.body;
    // validate
    const {error}=validateUser(req.body);
    if (error) return res.status(400).json({
        message: error.details[0].message
    });


    // already exist
    const userExist=await USERS.findOne({
        email:req.body.email
    })

    if (userExist) return res.status(400).json({
        message: "Email already Exist"
    })
    console.log(name);

    // hash pass
    const hashedPassword = await bcrypt.hash(req.body.password, 10);


    // create user

    const user =new USERS({
        name,email,
        password:hashedPassword

    })

    try{
        const userSaved = await user.save();
        res.json({
            id:userSaved._id,
            message:"User created successfully"
        })
    }
    catch(err){
        res.status(400).json({
            message:err.message
        })
    }






})


router.post("/login",async(req,res)=>{

    const {email,password}=req.body;

    try{
        // check if user exist
        const user = await USERS.findOne({
            email
        });
        if (!user) res.status(400).json({
            message: "User Not Found!"
        })

        const validPass = await bcrypt.compare(password, user.password)

        if (!validPass) return res.status(400).json({
            message: "Invalid Credentials"
        })

        // creating jwt

        // TOKEN CREATED WITH (email + _id)
        const payload={
            email:user.email,
            id:user._id
        }

        const userToken = await jwt.sign(payload, process.env.USER_TOKEN);
        // res.cookie('token',userToken,{httpOnly:true, secure:false,sameSite:'none' ,domain:'localhost'})
        // localStorage.setItem('token',userToken);
// 
          res.json({
              message: "Logged In",
              user,
              token:userToken
          })

    }
    catch(err){
        res.status(400).json({
            message:"Login Failed!"
        })
    }
    
})

router.get("/profile",async(req,res)=>{
    const authUser=req.headers.token;
   
    if(authUser){
       
        // we will get email and id
        const token = jwt.verify(authUser, process.env.USER_TOKEN);
        const {name,email,_id}=await USERS.findOne({_id:token.id})
       
        res.json({
           name,email,_id
        })
    }
    else{
        res.json(null);
    }
    

})


// IMAGES
router.post("/upload-by-link",async (req,res)=>{
    try {
        const {link}=req.body;
        
        const newImageName= 'photo'+Date.now()+".jpg";
        const tempPath = __dirname+'/temp_'+newImageName;

        const options={
            url:link,
            dest: tempPath
        }
        
        // Download image temporarily
        await imageDownloader.image(options);
        
        // Read the downloaded file
        const fileBuffer = fs.readFileSync(tempPath);
        
        // Upload to Supabase
        const { data, error } = await supabase.storage
            .from('hotel-images')
            .upload(newImageName, fileBuffer, {
                contentType: 'image/jpeg',
                upsert: false
            });

        // Clean up temporary file
        fs.unlinkSync(tempPath);

        if (error) {
            console.error('Supabase upload error:', error);
            return res.status(500).json({ error: 'Failed to upload image to storage' });
        }

        // Return just the filename for database storage
        // Frontend will call /image/:filename to get the public URL
        res.json(newImageName);
        
    } catch (error) {
        console.error('Upload by link error:', error);
        res.status(500).json({ error: 'Failed to process image upload' });
    }
})

// handling photos uploaded locally by machine
const photosMiddleware=multer({dest:'temp_uploads/'})
router.post("/upload", photosMiddleware.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const originalName = req.file.originalname;
        const fileExtension = path.extname(originalName);
        const newImageName = 'photo' + Date.now() + fileExtension;
        
        // Read the uploaded file
        const fileBuffer = fs.readFileSync(req.file.path);
        
        // Determine content type
        const contentType = req.file.mimetype || 'image/jpeg';
        
        // Upload to Supabase
        const { data, error } = await supabase.storage
            .from('hotel-images')
            .upload(newImageName, fileBuffer, {
                contentType: contentType,
                upsert: false
            });

        // Clean up temporary file
        fs.unlinkSync(req.file.path);

        if (error) {
            console.error('Supabase upload error:', error);
            return res.status(500).json({ error: 'Failed to upload image to storage' });
        }

        // Return just the filename for database storage  
        // Frontend will call /image/:filename to get the public URL
        res.json(newImageName);
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to process file upload' });
    }
})

// Get image URL from Supabase
router.get("/image/:filename", (req, res) => {
    try {
        const { filename } = req.params;
        const publicUrl = getSupabaseImageUrl(filename);
        res.json({ url: publicUrl });
    } catch (error) {
        console.error('Error getting image URL:', error);
        res.status(500).json({ error: 'Failed to get image URL' });
    }
});

// Get multiple image URLs from Supabase
router.post("/images", (req, res) => {
    try {
        const { filenames } = req.body;
        if (!Array.isArray(filenames)) {
            return res.status(400).json({ error: 'filenames must be an array' });
        }
        
        const imageUrls = filenames.map(filename => ({
            filename,
            url: getSupabaseImageUrl(filename)
        }));
        
        res.json(imageUrls);
    } catch (error) {
        console.error('Error getting image URLs:', error);
        res.status(500).json({ error: 'Failed to get image URLs' });
    }
});


// USER
router.post("/places",async(req,res)=>{
    
    const {
        title,
        address,
       addedPhotos,
        description,
        perks,
        extraInfo,
        checkIn,
        checkOut,
        maxGuests,
        price
    }=req.body

    if(!title ) return res.status(400).json({message:"Title is mandatory!"})
    if(!address ) return res.status(400).json({message:"Address is mandatory!"})
    if(!checkIn ) return res.status(400).json({message:"Please select a checkIn time!"})
    if(!checkOut ) return res.status(400).json({message:"Please select a checkOut time!"})
    if(!maxGuests ) return res.status(400).json({message:"Maximum number of guests field is required!"})
    if(!price ) return res.status(400).json({message:"Price is mandatory!"})

    const authUser = req.headers.token;
    const token = jwt.verify(authUser, process.env.USER_TOKEN);

   
    const place= new PLACES({
        // owner will be equal to id of the user
        owner:token.id,
        title,
        address,
        photos: addedPhotos,
        description,
        perks,
        extraInfo,
        checkIn,
        checkOut,
        maxGuests,
        price
    })

    try{
        const placeSaved= await place.save();

        res.json(placeSaved);
    }
    catch(err){
        res.json({error:err.message})
    }
})

//        for host to see his added/hosted places
router.get("/userPlaces",async(req,res)=>{
    try {
        const authUser = req.headers.token;
        const {id} = jwt.verify(authUser, process.env.USER_TOKEN);

        const ownerPlaces = await PLACES.find({owner:id});
        
        // Add image URLs to each place
        const placesWithImages = ownerPlaces.map(place => {
            const placeObj = place.toObject();
            if (placeObj.photos && placeObj.photos.length > 0) {
                placeObj.photoUrls = placeObj.photos.map(filename => ({
                    filename,
                    url: getSupabaseImageUrl(filename)
                }));
            }
            return placeObj;
        });
        
        res.json(placesWithImages);
    } catch (error) {
        console.error('Error getting user places:', error);
        res.status(500).json({ error: 'Failed to get user places' });
    }
})

// for host (to update teh form) for user (to see details from the landing page)
router.get('/places/:id',async(req,res)=>{
    try {
        const {id}=req.params;
        const place=await PLACES.findById(id);
        
        if (!place) {
            return res.status(404).json({ error: 'Place not found' });
        }
        
        // Convert place to object and add image URLs
        const placeObj = place.toObject();
        if (placeObj.photos && placeObj.photos.length > 0) {
            placeObj.photoUrls = placeObj.photos.map(filename => ({
                filename,
                url: getSupabaseImageUrl(filename)
            }));
        }
        
        res.json(placeObj);
    } catch (error) {
        console.error('Error getting place:', error);
        res.status(500).json({ error: 'Failed to get place details' });
    }
})
// update the  places by host
router.put("/places/", async (req,res)=>{

     const authUser = req.headers.token;
     const token = jwt.verify(authUser, process.env.USER_TOKEN);
    if(!token) return res.status(400).json({message:"You need to LogIn"})
    // console.log(token)
    const {
         id,
         title,
         address,
         addedPhotos,
         description,
         perks,
         extraInfo,
         checkIn,
         checkOut,
         maxGuests,
         price
     }=req.body

     const place=await PLACES.findById(id);
    //  console.log(place);
    //  accessing the id we got, to the id of the token(user logged in)
     if(token.id=== place.owner.toString()){
//              need to compare the objectID thing to string to compare to token id

        // ONE WAY
        // place.updateOne()
        // OTHER WAY:
        place.set({
            title,
            address,
            photos: addedPhotos,
            description,
            perks,
            extraInfo,
            checkIn,
            checkOut,
            maxGuests,
            price
        })
        await place.save();
        res.json('ok')
     }

})

// for user at the landing page
router.get('/places' , async(req,res)=>{
    try {
        const places = await PLACES.find();
        
        // Add image URLs to each place
        const placesWithImages = places.map(place => {
            const placeObj = place.toObject();
            if (placeObj.photos && placeObj.photos.length > 0) {
                placeObj.photoUrls = placeObj.photos.map(filename => ({
                    filename,
                    url: getSupabaseImageUrl(filename)
                }));
            }
            return placeObj;
        });
        
        res.json(placesWithImages);
    } catch (error) {
        console.error('Error getting places:', error);
        res.status(500).json({ error: 'Failed to get places' });
    }
})


// validating  the details
router.post("/validate",(req,res)=>{
    const {
        checkIn,
        checkOut,
        numberOfGuests,
        fullName,
        phoneNumber
    } = req.body;

    if(!checkIn) return res.status(400).json({message:"checkIn dates required!"})
    else if(!checkOut) return res.status(400).json({message:"checkOut dates required!"})
    else if(!fullName) return res.status(400).json({message:"Full Name required!"})
    else if(!numberOfGuests) return res.status(400).json({message:"Total Number of Guests required!"})
    else if(!phoneNumber) return res.status(400).json({message:"Phone Number required!"})
    else return res.json({mssage:'ok'})
    
})


// booking the place
router.post("/booking",async (req,res)=>{

      const authUser = req.headers.token;
      const {
          id
      } = jwt.verify(authUser, process.env.USER_TOKEN);
      if (!id) return res.status(400).send("User Access Denied")

    const {
        place,
        checkIn,
        checkOut,
        numberOfGuests,
        fullName,
         phoneNumber,
         price,
         
    } = req.body;
    

    const booking=new BOOKING({
        place,
        checkIn,
        checkOut,
        numberOfGuests,
        fullName, phoneNumber, price,user:id
    })
    const bookingSaved= await booking.save();
    res.json(bookingSaved)
})


// temp saving the till the payment gets success
router.post("/temp", async (req, res) => {
    const authUser = req.headers.token;
    const {
        id
    } = jwt.verify(authUser, process.env.USER_TOKEN);
    if (!id) return res.status(400).send("User Access Denied")

    const {
        place,
        checkIn,
        checkOut,
        numberOfGuests,
        fullName,
        phoneNumber,
        price,

    } = req.body;

    
    const tempBooking = new TEMP({
        place,
        checkIn,
        checkOut,
        numberOfGuests,
        fullName,
        phoneNumber,
        price,
        user: id
    })
    const tempBookingSaved = await tempBooking.save();
    res.json(tempBookingSaved)
})

router.get("/getTempBooking",async(req,res)=>{

    // console.log(req.headers.tempbookingid);
    const tempId = req.headers.tempbookingid;
      
    //    console.log(hello)
    const tempBookedData = await TEMP.findById(tempId);
    if(!tempBookedData) return res.status(400).json("Booking failed")
    res.json(tempBookedData);

})

router.get("/booking",async(req,res)=>{
     const authUser = req.headers.token;
     const {
         id
     } = jwt.verify(authUser, process.env.USER_TOKEN);
     if(!id) return res.status(400).send("User Access Denied")

     try{
        const response = await BOOKING.find({
            user: id
        }).populate('place');
        
        res.json(response);
     }
     catch(err){
        throw err;
     }
     

     
})


router.get('/host/:id',async(req,res)=>{

    const {id}=req.params;
    
    try {
        const place=await PLACES.findById(id).populate('owner');
       
        res.json(place.owner);
    } catch (error) {
        res.json(error)
    }


})



module.exports=router;