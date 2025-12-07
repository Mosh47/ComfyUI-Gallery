import { GalleryProvider } from './GalleryContext';
import GalleryOpenButton from './GalleryOpenButton';
import GalleryModal from './GalleryModal';

function Gallery() {
    return (
        <GalleryProvider>
            <GalleryOpenButton />
            <GalleryModal />
        </GalleryProvider>
    );
}

export default Gallery;
